import { instanceToPlain } from 'class-transformer';

export class EntityHelper {
  toJSON() {
    return instanceToPlain(this);
  }
}
