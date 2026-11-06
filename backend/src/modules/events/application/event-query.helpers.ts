import {
  EVENT_DEFAULT_WINDOW_MS,
  InvalidEventTimeRangeError,
  type EventQueryClock,
  type EventRepositorySearchQuery,
  type EventSearchInput,
} from "../domain/event-query.contracts.js";

export function toRepositorySearchQuery(
  input: EventSearchInput,
  clock: EventQueryClock,
): EventRepositorySearchQuery {
  const now = clock.now();
  const to = input.to ?? now;
  const from = input.from ?? new Date(to.getTime() - EVENT_DEFAULT_WINDOW_MS);

  if (from.getTime() > to.getTime()) {
    throw new InvalidEventTimeRangeError();
  }

  return {
    orgId: input.orgId,
    ...(input.query === undefined ? {} : { query: input.query }),
    ...(input.classUid === undefined ? {} : { classUid: input.classUid }),
    ...(input.severityId === undefined
      ? {}
      : { severityId: input.severityId }),
    ...(input.srcIp === undefined ? {} : { srcIp: input.srcIp }),
    ...(input.dstIp === undefined ? {} : { dstIp: input.dstIp }),
    ...(input.username === undefined ? {} : { username: input.username }),
    ...(input.hostname === undefined ? {} : { hostname: input.hostname }),
    ...(input.collectorId === undefined
      ? {}
      : { collectorId: input.collectorId }),
    from,
    to,
    offset: (input.page - 1) * input.limit,
    limit: input.limit,
    sort: input.sort,
    order: input.order,
  };
}
