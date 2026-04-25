export class TimeOffBalance {
  constructor(
    public readonly employeeId: string,
    public readonly locationId: string,
    public amount: number,
    public version: number,
    public lastSyncedAt: Date,
    public updatedAt: Date,
  ) {}

  /**
   * Deducts a specific amount of days from the balance.
   * Throws an error if the balance is insufficient.
   */
  deduct(days: number): void {
    if (this.amount < days) {
      throw new Error('Insufficient balance');
    }
    this.amount -= days;
    this.updatedAt = new Date();
  }

  /**
   * Updates balance from sync and increments version
   */
  sync(amount: number): void {
    this.amount = amount;
    this.lastSyncedAt = new Date();
    this.updatedAt = new Date();
  }
}
