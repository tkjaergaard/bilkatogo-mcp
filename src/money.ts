/** øre → DKK. Bilka sends every price, total and fee in øre. */
export function kroner(ore: number | undefined): number | null {
  return ore === undefined ? null : Math.round(ore) / 100;
}
