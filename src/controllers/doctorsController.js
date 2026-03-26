import User from '../models/User.js'

export async function listDoctors(_req, res) {
  const doctors = await User.find(
    { userType: 'doctor', isActive: true },
    {
      firstName: 1,
      lastName: 1,
      bio: 1,
      email: 1,
      specialty: 1,
      experienceYears: 1,
      avatarUrl: 1,
    }
  ).sort({ lastName: 1, firstName: 1 })

  const data = doctors.map((d) => ({
    id: d._id,
    email: d.email,
    firstName: d.firstName ?? '',
    lastName: d.lastName ?? '',
    displayName: [d.firstName, d.lastName].filter(Boolean).join(' ').trim(),
    specialty: d.specialty ?? '',
    experienceYears: Number.isFinite(Number(d.experienceYears)) ? Number(d.experienceYears) : null,
    avatarUrl: d.avatarUrl ?? '',
    bio: d.bio ?? '',
  }))

  return res.json({ doctors: data })
}

