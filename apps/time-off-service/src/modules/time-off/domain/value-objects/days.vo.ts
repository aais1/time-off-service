export class Days {
  private readonly value: number;

  constructor(value: number) {
    if (value <= 0) {
      throw new Error('Days must be a positive number greater than zero');
    }
    if (!Number.isInteger(value)) {
      throw new Error('Days must be an integer');
    }
    this.value = value;
  }

  getValue(): number {
    return this.value;
  }
}
