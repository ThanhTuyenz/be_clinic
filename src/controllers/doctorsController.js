import User from '../models/User.js'
import Specialty from '../models/Specialty.js'
import Department from '../models/Department.js'

export async function listDoctors(_req, res) {
  const doctors = await User.find(
    { userType: 'doctor', isActive: true },
    {
      firstName: 1,
      lastName: 1,
      bio: 1,
      email: 1,
      avatarUrl: 1,
      experienceYears: 1,
      specialtyId: 1,
      specialtyID: 1,
    }
  ).sort({ lastName: 1, firstName: 1 })

  // Build specialtyName map based on specialtyId/specialtyID from Mongo.
  const specialtyIds = Array.from(
    new Set(
      doctors
        .map((d) => d.specialtyID ?? d.specialtyId)
        .filter(Boolean)
        .map((id) => String(id))
    )
  )

  const specialties = specialtyIds.length
    ? await Specialty.find(
        { specialtyID: { $in: specialtyIds } },
        { specialtyName: 1, specialtyID: 1, deptID: 1 }
      ).lean()
    : []

  const specialtyNameById = new Map(
    specialties.map((s) => [String(s.specialtyID), s.specialtyName || ''])
  )

  const deptIds = Array.from(
    new Set(
      specialties
        .map((s) => String(s?.deptID || '').trim())
        .filter(Boolean)
    )
  )

  const departments = deptIds.length
    ? await Department.find({ deptID: { $in: deptIds } }, { deptID: 1, deptName: 1 }).lean()
    : []

  const deptNameById = new Map(
    departments.map((d) => [String(d.deptID), d.deptName || ''])
  )

  const deptIdBySpecialtyId = new Map(
    specialties.map((s) => [String(s.specialtyID), String(s?.deptID || '').trim()])
  )

  const data = doctors.map((d) => {
    const specId = d.specialtyID ?? d.specialtyId
    const specialtyName = specId ? specialtyNameById.get(String(specId)) || '' : ''
    const deptID = specId ? deptIdBySpecialtyId.get(String(specId)) || '' : ''
    const deptName = deptID ? deptNameById.get(String(deptID)) || '' : ''
    return {
      id: d._id ? String(d._id) : '',
      email: d.email,
      firstName: d.firstName ?? '',
      lastName: d.lastName ?? '',
      displayName: [d.lastName, d.firstName].filter(Boolean).join(' ').trim(),
      bio: d.bio ?? '',
      avatarUrl: d.avatarUrl ?? '',
      experienceYears: d.experienceYears ?? null,
      specialtyName,
      specialtyID: specId ? String(specId) : '',
      deptID,
      deptName,
    }
  })

  return res.json({ doctors: data })
}

