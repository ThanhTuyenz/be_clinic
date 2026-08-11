import * as bcrypt from 'bcrypt';

export async function hashPassword(rawPassword: string) {
  const salt = await bcrypt.genSalt();
  const hash = await bcrypt.hash(rawPassword, salt);

  return hash;
}

export async function compareHash(rawPassword: string, hashedPassword: string) {
  return await bcrypt.compare(rawPassword, hashedPassword);
}
