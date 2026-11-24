const UNSAFE_METHODS = new Set(["post", "put", "patch", "delete"]);

export function isUnsafeHttpMethod(method: string | null | undefined): boolean {
  return method ? UNSAFE_METHODS.has(method.toLowerCase()) : false;
}
