import { MongoRepository } from 'typeorm';
import type { ObjectId } from 'mongodb';
type EntityWithSlug = {
    slug: string;
    _id?: ObjectId;
};
export type GenerateUniqueSlugOptions = {
    excludeId?: ObjectId;
};
export declare function generateUniqueSlug<T extends EntityWithSlug>(input: string, repository: MongoRepository<T>, options?: GenerateUniqueSlugOptions): Promise<string>;
export declare function removeVietnameseTones(str: string): string;
export {};
