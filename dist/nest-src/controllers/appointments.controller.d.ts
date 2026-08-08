import type { Request, Response } from 'express';
export declare class AppointmentsController {
    listMyAppointments(req: Request, res: Response): Promise<any>;
    listDoctorAppointments(req: Request, res: Response): Promise<any>;
    lookupAppointmentByTicket(req: Request, res: Response): Promise<any>;
    lookupPatientByCode(req: Request, res: Response): Promise<any>;
    listPatientsReception(req: Request, res: Response): Promise<any>;
    listPatientHistoryReception(req: Request, res: Response): Promise<any>;
    listReceptionAppointments(req: Request, res: Response): Promise<any>;
    getAvailability(req: Request, res: Response): Promise<any>;
    getDoctorScheduleDates(req: Request, res: Response): Promise<any>;
    createAppointmentReception(req: Request, res: Response): Promise<any>;
    updateAppointmentStatusReception(req: Request, res: Response): Promise<any>;
    cancelAppointment(req: Request, res: Response): Promise<any>;
    createAppointment(req: Request, res: Response): Promise<any>;
}
