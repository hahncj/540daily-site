/**
 * Placeholder for a service a later stage builds. Each `Services` field exists now so parallel lanes
 * fill in their own service without editing shared wiring. Calling a planned service throws.
 */
export type PlannedService<Name extends string> = { readonly planned: Name } & Record<string, never>;

export function planned<Name extends string>(name: Name, stage: string): PlannedService<Name> {
  return new Proxy({ planned: name } as PlannedService<Name>, {
    get(target, prop) {
      if (prop === "planned") return target.planned;
      if (typeof prop === "symbol" || prop === "then" || prop === "toJSON") return undefined;
      throw new Error(`services.${name}.${String(prop)} is not built yet (planned for ${stage}).`);
    },
  });
}
