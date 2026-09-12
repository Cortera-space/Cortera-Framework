export {
  createActionHandler,
  type CreateActionHandlerOptions,
} from "./route-handler";

export {
  resolveActorFromRequest,
  type ResolveActorOptions,
  type ApiKeyMapping,
} from "./auth";

export {
  createApprovalRouteHandler,
  type ApprovalRouteOptions,
} from "./approval-route";

export {
  createReviewRouteHandler,
  type ReviewRouteOptions,
} from "./review-route";

export {
  createEventsRouteHandler,
  createEventChainRouteHandler,
  createContainedActorsRouteHandler,
  createPendingApprovalsRouteHandler,
  createEventStreamRouteHandler,
  type ObservabilityRouteOptions,
} from "./observability-routes";
