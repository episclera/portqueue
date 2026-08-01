/**
 * The shape of one mutation.
 *
 * Every action the dashboard can ask for is its own file exporting one of these, and the registry in
 * `index.ts` maps {@link ActionKind} → route. The kind is also the action's URL segment
 * (`POST /api/actions/<kind>`), so dispatch is a `Map` lookup on the path, an unknown action is a
 * miss, and each action validates only its own fields — which is what the single handler this
 * replaced kept getting wrong, because the checks for twelve actions had to be ordered against one
 * another.
 */
import type { PortQueue } from '@portqueue/core';
import type { HandlerResult } from '../../http';
import type { ActionKind, ActionPayloadDto } from '../../../../shared/dto';

export interface ActionContext {
  /** The dashboard's own headless client, already connected. */
  readonly portQueue: PortQueue;
  /** The parsed request body. Each action reads only the fields it needs, and validates them. */
  readonly action: ActionPayloadDto;
}

export interface ActionRoute {
  /** Identifies the action, and names the endpoint it answers: `POST /api/actions/<kind>`. */
  readonly kind: ActionKind;
  /** One-line description of the mutation; the registry is the action API's index. */
  readonly summary: string;
  handle(ctx: ActionContext): Promise<HandlerResult>;
}
