export type GuestPreferencePersistence<Value> = {
  load: () => Value | null;
  save?: (value: Value) => void;
  unsupportedMessage?: string;
};

export type PreferenceClientCache<Value> = {
  load: () => Value | null;
  save: (value: Value) => void;
  clear: () => void;
};

export type PreferenceColumn = {
  name: string;
};

export type UserPreferenceDefinition<
  Key extends string,
  Value,
  Option = never,
> = {
  key: Key;
  column: PreferenceColumn;
  defaultValue: Value;
  options?: readonly Option[];
  copy: (value: Value) => Value;
  normalize: (value: unknown) => Value;
  guestPersistence?: GuestPreferencePersistence<Value>;
  clientCache?: PreferenceClientCache<Value>;
};
