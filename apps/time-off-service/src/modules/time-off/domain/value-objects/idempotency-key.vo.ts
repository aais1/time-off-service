import { validate as uuidValidate } from 'uuid';

export class IdempotencyKey {
  private readonly value: string;

  constructor(value: string) {
    if (!value || !uuidValidate(value)) {
      throw new Error('IdempotencyKey must be a valid UUID');
    }
    this.value = value;
  }

  getValue(): string {
    return this.value;
  }
}
