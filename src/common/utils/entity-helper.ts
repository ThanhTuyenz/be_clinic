import { instanceToPlain } from 'class-transformer';
import { AfterLoad, BaseEntity } from 'typeorm';

export class EntityHelper extends BaseEntity {
  __entity?: string;

  @AfterLoad()
  setEntityName() {
    this.__entity = this.constructor.name;
  }

  toJSON() {
    const plain = instanceToPlain(this);
    if (plain && typeof plain === 'object') {
      for (const key of Object.keys(plain)) {
        const original = (this as any)[key];
        if (original && original.constructor) {
          const className = original.constructor.name;
          if (className === 'ObjectID' || className === 'ObjectId') {
            plain[key] = original.toString();
          }
        }
      }
    }
    return plain;
  }
}
