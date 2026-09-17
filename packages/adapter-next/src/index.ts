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
  createConfirmationRouteHandler,
  type ConfirmationRouteOptions,
} from "./confirmation-route";

export {
  createRollbackRouteHandler,
  type RollbackRouteOptions,
} from "./rollback-route";

export {
  createEventsRouteHandler,
  createEventChainRouteHandler,
  createContainedActorsRouteHandler,
  createPendingApprovalsRouteHandler,
  createEventStreamRouteHandler,
  type ObservabilityRouteOptions,
} from "./observability-routes";
