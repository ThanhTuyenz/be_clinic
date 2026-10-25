// Điều kiện lọc đơn giản; các service chuyển truy vấn sang Prisma.
export type EntityCondition<T> = {
  [Key in keyof T]?: T[Key] extends object ? Partial<T[Key]> : T[Key];
};
