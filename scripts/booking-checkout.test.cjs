require('ts-node/register/transpile-only');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
    if (request.startsWith('src/')) request = path.resolve(request);
    if (request.endsWith('.js') && parent) {
        const source = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts');
        if (fs.existsSync(source)) return resolve.call(this, source, parent, ...rest);
    }
    return resolve.call(this, request, parent, ...rest);
};
const { BookingService } = require('../src/modules/bookings/booking.service.ts');
const { Prisma } = require('@prisma/client');
function fixture(options = {}) {
    const calls = [];
    let appt = 0;
    const record = (name, result) => async (args) => { calls.push({ name, args: JSON.parse(JSON.stringify(args)) }); return typeof result === 'function' ? result(args) : result; };
    const doctor = { id: 'doctor', isActive: !options.inactiveDoctor, user: { fullName: 'Doctor' }, consultationFee: new Prisma.Decimal(150000), onlineConsultationFee: options.onlineFeeNull ? null : new Prisma.Decimal(120000) };
    const schedule = { id: 'schedule', status: 'OPEN', doctor, doctorId: doctor.id, branchId: 'east', workDate: new Date((options.date || '2026-10-21') + 'T00:00:00Z'), slotDurationMin: 30, capacityPerSlot: 2 };
    const slot = { id: slotId, isActive: true, slotStatus: options.slotStatus || 'AVAILABLE', schedule, startTime: new Date(`1970-01-01T${options.start || '08:00'}:00Z`), endTime: new Date(`1970-01-01T${options.end || '08:30'}:00Z`) };
    const bbm = { branchId: 'east', isEnabled: true, bookingMethodId: 'method' };
    const pkg = { id: 'pkg', isActive: true, specialtyId: 1, name: 'Package', price: new Prisma.Decimal(200000), branchBookingMethod: bbm, branchBookingMethods: [], receptionSchedules: [{ branchId: 'east', dayOfWeek: options.dayOfWeek ?? 3, sessions: options.sessions || ['MORNING'] }] };
    const tx = {
        branchBookingMethod: { findFirst: record('branchMethod.findFirst', options.disabledBranchMethod ? null : { id: 'branch-method' }) },
        patientProfile: { findFirst: record('patientProfile.findFirst', options.noProfile ? null : { id: 'p1', fullName: 'Patient' }), findMany: record('patientProfile.findMany', args => args.where.id.in.map(id => ({ id, fullName: id }))) },
        doctorSchedule: { findUnique: record('doctorSchedule.findUnique', schedule) },
        doctorScheduleSlot: { findUnique: record('slot.findUnique', slot), upsert: record('slot.upsert', slot) },
        servicePackage: { findUnique: record('package.findUnique', options.noPackage ? null : pkg) },
        doctorSpecialty: { count: record('doctorSpecialty.count', options.incompatible ? 0 : 1) },
        appointment: { findFirst: record('appointment.findFirst', options.duplicate ? { id: 'duplicate' } : null), create: record('appointment.create', ({ data }) => ({ id: 'a' + (++appt), ...data, status: 'HOLD' })) },
        bookingMethod: { findFirst: record('bookingMethod.findFirst', options.noMethod ? null : { id: 'method' }) },
        invoice: { create: record('invoice.create', ({ data }) => ({ id: 'invoice', ...data })) },
        paymentTransaction: { create: record('payment.create', ({ data }) => ({ id: 'payment', ...data })) },
        outboxEvent: { create: record('outbox.create', {}) },
        bookingOrder: { create: record('bookingOrder.create', ({ data }) => ({ id: 'order', ...data })) },
        $executeRaw: async (strings, ...values) => { calls.push({ name: 'execute', sql: strings.join('?').replace(/\s+/g, ' ').trim(), values }); return options.full ? 0 : 1; },
        $queryRaw: async (strings, ...values) => { const sql = strings.join('?').replace(/\s+/g, ' ').trim(); calls.push({ name: 'query', sql, values }); return sql.startsWith('SELECT s.') ? [] : [{ now: new Date(), expiresAt: new Date(Date.now() + 600000) }]; },
    };
    const prisma = { $transaction: async (fn, options) => { calls.push({ name: 'transaction', options }); return fn(tx); } };
    const vouchers = { validateVoucher: record('voucher.validate', { discountAmount: 10000, voucher: { id: 'voucher', code: 'SAVE' } }), recordVoucherUsage: async (_, id, account, discount, ref) => { calls.push({ name: 'voucher.record', id, account, discount, ref }); } };
    const analytics = { attribution: async (_, account, dto, context) => { calls.push({ name: 'analytics', account, dto, context }); return {}; } };
    return { service: new BookingService(prisma, { getOrThrow: () => ({ holdTtlMs: 600000 }) }, vouchers, analytics), calls, tx };
}
const { test } = require('node:test');
const assert = require('node:assert/strict');
const slotId = '550e8400-e29b-41d4-a716-446655440000';
function freeze(t) {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-19T02:00:00Z') });
}
const doctorItem = { patientProfileId: 'p1', scheduleSlotId: slotId, bookingMethodCode: 'CONSULTATION' };

test('family service bookings retain each package and charge package prices in one invoice', async t => {
    freeze(t);
    const { service, calls } = fixture();
    const item = { ...doctorItem, bookingMethodCode: 'SPECIALTY_EXAM', servicePackageId: 'pkg' };
    const result = await service.batchCheckout('owner', { groupType: 'FAMILY', items: [item, { ...item, patientProfileId: 'p2' }], voucherCode: 'SAVE' });
    assert.equal(result.subtotal, 400000);
    assert.equal(result.serviceFee, 10000);
    assert.equal(result.totalAmount, 400000);
    const appointments = calls.filter(c => c.name === 'appointment.create').map(c => c.args.data);
    assert.deepEqual(appointments.map(a => a.servicePackageId), ['pkg', 'pkg']);
    assert.deepEqual(appointments.map(a => Number(a.servicePrice)), [200000, 200000]);
    assert.deepEqual(calls.find(c => c.name === 'invoice.create').args.data.items.create.map(i => Number(i.amount)), [200000, 200000, 10000, -10000]);
    assert.equal(calls.filter(c => c.name === 'doctorSpecialty.count').length, 2);
});

test('checkout only accepts persisted UUID slots and never creates a slot', async t => {
    freeze(t);
    for (const batch of [false, true]) {
        for (const scheduleSlotId of ['virtual_schedule_23:00', 'invalid', undefined]) {
            const { service, calls } = fixture();
            const item = { ...doctorItem, scheduleSlotId };
            await assert.rejects(service[batch ? 'batchCheckout' : 'checkout']('owner', batch ? { items: [item] } : item), error => error.getStatus() === 400);
            assert.equal(calls.length, 0);
        }
    }
});

test('inactive doctors and unavailable slots are rejected before reserving in all checkout branches', async t => {
    freeze(t);
    for (const batch of [false, true]) {
        for (const bookingMethodCode of ['CONSULTATION', 'SPECIALTY_EXAM']) {
            for (const options of [{ inactiveDoctor: true }, { slotStatus: 'BLOCKED' }]) {
                const { service, calls } = fixture(options);
                const item = { ...doctorItem, bookingMethodCode, ...(bookingMethodCode === 'SPECIALTY_EXAM' ? { servicePackageId: 'pkg' } : {}) };
                await assert.rejects(service[batch ? 'batchCheckout' : 'checkout']('owner', batch ? { items: [item] } : item), error => error.getStatus() === 404);
                assert.equal(calls.some(c => ['execute', 'appointment.create', 'invoice.create'].includes(c.name)), false);
            }
        }
    }
});

test('family service booking rejects a doctor from another specialty before reserving', async t => {
    freeze(t);
    const { service, calls } = fixture({ incompatible: true });
    await assert.rejects(service.batchCheckout('owner', { groupType: 'FAMILY', items: [{ ...doctorItem, bookingMethodCode: 'SPECIALTY_EXAM', servicePackageId: 'pkg' }] }), error => error.getStatus() === 400);
    assert.equal(calls.some(c => ['execute', 'appointment.create'].includes(c.name)), false);
});

test('single and batch after-hours checkout allow weekend sessions and reject weekday evenings before reserving', async t => {
    freeze(t);
    const item = { ...doctorItem, bookingMethodCode: 'AFTER_HOURS', servicePackageId: 'pkg' };
    for (const batch of [false, true]) {
        for (const [date, dayOfWeek, start, end, allowed] of [
            ['2026-10-23', 5, '17:00', '17:30', false],
            ['2026-10-24', 6, '08:00', '08:30', true],
            ['2026-10-24', 6, '14:00', '14:30', true],
            ['2026-10-25', 0, '08:00', '08:30', true],
            ['2026-10-25', 0, '17:00', '17:30', true],
            ['2026-10-26', 1, '17:00', '17:30', false],
        ]) {
            const { service, calls } = fixture({ date, dayOfWeek, start, end, sessions: ['MORNING', 'AFTERNOON', 'EVENING'] });
            const run = () => service[batch ? 'batchCheckout' : 'checkout']('owner', batch ? { items: [item] } : item);
            if (allowed) {
                const result = await run();
                assert.equal(result.subtotal, 200000);
                assert.equal(calls.filter(c => c.name === 'appointment.create').length, 1);
            } else {
                await assert.rejects(run(), error => error.getStatus() === 400 && error.message.includes('thứ Bảy và Chủ nhật'));
                assert.equal(calls.some(c => ['execute', 'appointment.create', 'invoice.create'].includes(c.name)), false);
            }
        }
    }
});

test('full package checkout rejects the selected slot without changing to another doctor', async t => {
    freeze(t);
    const { service, calls, tx } = fixture({ full: true });
    tx.$queryRaw = async () => { throw new Error('Must not search for another doctor'); };
    await assert.rejects(service.checkout('owner', { ...doctorItem, bookingMethodCode: 'SPECIALTY_EXAM', servicePackageId: 'pkg' }), error => error.getStatus() === 409);
    assert.equal(calls.filter(c => c.name === 'slot.findUnique').length, 1);
    assert.equal(calls.some(c => c.name === 'appointment.create'), false);
});

test('single checkout charges the correct doctor price and records one voucher, invoice, payment and hold event', async (t) => {
    freeze(t);
    for (const bookingMethodCode of ['CONSULTATION', 'ONLINE_CONSULTATION']) {
        const { service, calls } = fixture();
        const result = await service.checkout('owner', { ...doctorItem, bookingMethodCode, voucherCode: 'SAVE' });
        const subtotal = bookingMethodCode === 'CONSULTATION' ? 150000 : 120000;
        assert.equal(result.subtotal, subtotal);
        assert.equal(result.serviceFee, 10000);
        assert.equal(result.discountAmount, 10000);
        assert.equal(result.totalAmount, subtotal);
        assert.equal(result.status, 'HOLD');
        assert.equal(result.holdExpiresAt.getTime() - result.holdStartedAt.getTime(), 600000);
        assert.deepEqual(calls[0].options, { isolationLevel: 'Serializable' });
        for (const name of ['invoice.create', 'payment.create', 'outbox.create', 'voucher.record']) {
            assert.equal(calls.filter(call => call.name === name).length, 1);
        }
        const invoice = calls.find(call => call.name === 'invoice.create').args.data;
        assert.equal(invoice.appointmentId, result.appointmentId);
        assert.deepEqual(invoice.items.create.map(item => Number(item.amount)), [subtotal, 10000, -10000]);
        const event = calls.find(call => call.name === 'outbox.create').args.data;
        assert.equal(event.eventType, 'appointment.hold.created');
        assert.equal(event.payload.appointmentId, result.appointmentId);
    }
});
test('package checkout keeps its package price, invoice description and method', async (t) => {
    freeze(t);
    const { service, calls } = fixture();
    const result = await service.checkout('owner', { ...doctorItem, bookingMethodCode: 'SPECIALTY_EXAM', servicePackageId: 'pkg' });
    assert.equal(result.subtotal, 200000);
    assert.equal(result.totalAmount, 210000);
    assert.equal(result.discountAmount, 0);
    assert.equal(calls.some(call => call.name === 'voucher.validate'), false);
    const invoice = calls.find(call => call.name === 'invoice.create').args.data;
    assert.equal(invoice.items.create[0].description, 'Package');
    const appointment = calls.find(call => call.name === 'appointment.create').args.data;
    assert.equal(appointment.servicePackageId, 'pkg');
    assert.equal(appointment.bookingMethodId, 'method');
});
test('family checkout shares one invoice, one service fee, one voucher and one order event', async (t) => {
    freeze(t);
    const { service, calls } = fixture();
    const result = await service.batchCheckout('owner', { items: [doctorItem, { ...doctorItem, patientProfileId: 'p2' }], voucherCode: 'SAVE' });
    assert.equal(result.groupType, 'FAMILY');
    assert.equal(result.appointments.length, 2);
    assert.equal(result.subtotal, 300000);
    assert.equal(result.serviceFee, 10000);
    assert.equal(result.totalAmount, 300000);
    assert.equal(result.bookingOrderId, 'order');
    for (const name of ['invoice.create', 'payment.create', 'outbox.create', 'voucher.validate', 'voucher.record']) {
        assert.equal(calls.filter(call => call.name === name).length, 1);
    }
    const invoice = calls.find(call => call.name === 'invoice.create').args.data;
    assert.equal(invoice.bookingOrderId, 'order');
    assert.deepEqual(invoice.items.create.map(item => Number(item.amount)), [150000, 150000, 10000, -10000]);
    const event = calls.find(call => call.name === 'outbox.create').args.data;
    assert.equal(event.eventType, 'booking_order.hold.created');
    assert.deepEqual(event.payload.appointmentIds, result.appointments.map(item => item.appointmentId));
});
test('single and batch checkout stop on duplicate appointments or a full slot without creating invoice, payment or event', async (t) => {
    freeze(t);
    for (const mode of ['duplicate', 'full'])
        for (const batch of [false, true]) {
            const { service, calls } = fixture({ [mode]: true });
            const dto = batch ? { items: [doctorItem] } : doctorItem;
            await assert.rejects(service[batch ? 'batchCheckout' : 'checkout']('owner', dto), error => error.getStatus() === 409);
            assert.equal(calls.some(call => ['invoice.create', 'payment.create', 'outbox.create'].includes(call.name)), false);
        }
});
test('doctor bookings cannot silently ignore a package and empty batches remain rejected', async () => {
    const { service, calls } = fixture();
    await assert.rejects(service.batchCheckout('owner', { items: [] }), error => error.getStatus() === 400);
    await assert.rejects(service.batchCheckout('owner', { groupType: 'FAMILY', items: [{ ...doctorItem, servicePackageId: 'pkg' }] }), error => error.getStatus() === 400);
    assert.equal(calls.length, 0);
});

test('all checkout methods reject a branch which disabled the requested method before reserving', async t => {
    freeze(t);
    for (const batch of [false, true]) for (const code of ['CONSULTATION', 'ONLINE_CONSULTATION', 'SPECIALTY_EXAM', 'HEALTH_PACKAGE', 'AFTER_HOURS']) {
        const { service, calls } = fixture({ disabledBranchMethod: true });
        const item = { ...doctorItem, bookingMethodCode: code, ...(['SPECIALTY_EXAM', 'HEALTH_PACKAGE', 'AFTER_HOURS'].includes(code) ? { servicePackageId: 'pkg' } : {}) };
        await assert.rejects(service[batch ? 'batchCheckout' : 'checkout']('owner', batch ? { items: [item] } : item), /Cơ sở đã ngừng hoạt động/);
        assert.equal(calls.some(call => call.name === 'execute' || call.name === 'appointment.create'), false);
        const where = calls.find(call => call.name === 'branchMethod.findFirst').args.where;
        assert.deepEqual(where.branch, { isActive: true });
        assert.equal(where.bookingMethod.code, code);
    }
});

test('family checkout rejects six members, duplicate profiles and different days', async t => {
    freeze(t);
    for (const items of [Array.from({ length: 6 }, (_, i) => ({ ...doctorItem, patientProfileId: 'p' + i })), [doctorItem, doctorItem]]) {
        const { service, calls } = fixture();
        await assert.rejects(service.batchCheckout('owner', { items }), error => error.getStatus() === 400);
        assert.equal(calls.length, 0);
    }
    const { service, tx, calls } = fixture();
    const find = tx.doctorScheduleSlot.findUnique;
    let index = 0;
    tx.doctorScheduleSlot.findUnique = async args => {
        const slot = await find(args);
        return { ...slot, schedule: { ...slot.schedule, workDate: new Date(`2026-10-${21 + index++}T00:00:00Z`) } };
    };
    await assert.rejects(service.batchCheckout('owner', { items: [doctorItem, { ...doctorItem, patientProfileId: 'p2' }] }), /phải khám cùng ngày/);
    assert.equal(calls.some(call => call.name === 'invoice.create' || call.name === 'bookingOrder.create'), false);
});

test('overlap checks compare the patient date and time range across doctors, including in-examination visits', async t => {
    freeze(t);
    const { service, tx } = fixture();
    let filter;
    tx.appointment.findFirst = async ({ where }) => { filter = where; return { id: 'existing-on-another-doctor' }; };
    await assert.rejects(service.checkout('owner', doctorItem), /trùng giờ/);
    assert.equal(filter.scheduleSlotId, undefined);
    assert.equal(filter.scheduleSlot.startTime.lt.toISOString().slice(11, 16), '08:30');
    assert.equal(filter.scheduleSlot.endTime.gt.toISOString().slice(11, 16), '08:00');
    assert.ok(filter.status.in.includes('IN_EXAMINATION'));
});
