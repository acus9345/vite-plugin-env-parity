/** Machine-readable reason for an {@link EnvParityError}. */
export type EnvParityErrorCode = "ENV_MISMATCH" | "EXAMPLE_NOT_FOUND" | "FILE_UNREADABLE" | "INVALID_OPTIONS";

/**
 * Thrown (during `vite build` by default) when the env does not match the
 * example file, or when the plugin is misconfigured. The message always says
 * what went wrong and how to fix it.
 */
export class EnvParityError extends Error {
  /** Machine-readable reason, handy for `switch` statements. */
  declare readonly code: EnvParityErrorCode;

  constructor(code: EnvParityErrorCode, message: string) {
    super(message);
    this.name = "EnvParityError";
    // Non-enumerable so Vite's error output shows only the message.
    Object.defineProperty(this, "code", { value: code, enumerable: false });
    // This error is about the user's files, not our code: a stack trace only adds noise.
    this.stack = `${this.name}: ${message}`;
  }
}
