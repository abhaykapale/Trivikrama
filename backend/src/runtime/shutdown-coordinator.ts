export interface ShutdownResource {
  readonly name: string;
  close(): Promise<void>;
}

export interface ShutdownFailure {
  readonly resourceName: string;
  readonly error: unknown;
}

export interface ShutdownResult {
  readonly closed: readonly string[];
  readonly failures: readonly ShutdownFailure[];
}

/**
 * Closes registered runtime resources in the supplied order. The composition
 * root should register future queue workers/subscribers before HTTP, then the
 * database clients last, so active work does not lose its dependencies.
 */
export class ShutdownCoordinator {
  private shutdownPromise: Promise<ShutdownResult> | null = null;

  public constructor(private readonly resources: readonly ShutdownResource[]) {
    assertResourcesAreValid(resources);
  }

  public shutdown(): Promise<ShutdownResult> {
    if (this.shutdownPromise === null) {
      this.shutdownPromise = this.closeResources();
    }

    return this.shutdownPromise;
  }

  private async closeResources(): Promise<ShutdownResult> {
    const closed: string[] = [];
    const failures: ShutdownFailure[] = [];

    for (const resource of this.resources) {
      try {
        await resource.close();
        closed.push(resource.name);
      } catch (error: unknown) {
        failures.push({ resourceName: resource.name, error });
      }
    }

    return { closed, failures };
  }
}

function assertResourcesAreValid(resources: readonly ShutdownResource[]): void {
  const names = new Set<string>();

  for (const resource of resources) {
    const name = resource.name.trim();

    if (name.length === 0) {
      throw new Error("Shutdown resource name cannot be empty");
    }

    if (names.has(name)) {
      throw new Error(`Duplicate shutdown resource name: ${name}`);
    }

    names.add(name);
  }
}
