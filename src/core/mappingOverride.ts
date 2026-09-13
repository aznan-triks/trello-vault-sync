/** Per-mapping override of a global on/off sync setting: follow it, or force it either way. */
export type MappingOverride = "inherit" | "on" | "off";

/** `undefined` covers mappings saved before this override existed — same as explicit "inherit". */
export function resolveOverride(override: MappingOverride | undefined, globalValue: boolean): boolean {
	if (!override || override === "inherit") return globalValue;
	return override === "on";
}

/** Sanitizes a raw `data.json` value into a valid mode, defaulting to "inherit". */
export function safeOverrideMode(value: unknown): MappingOverride {
	return value === "on" || value === "off" ? value : "inherit";
}
