/** Barrel for the wire DTOs. Split by concern under `dto/`; import from here. */
export type * from './dto/job';
export type * from './dto/queue';
export type * from './dto/schedule';
export type * from './dto/config';
export type {
  ActionPayloadDto,
  ActionRequestDto,
  ActionResultDto,
  AddJobRequestDto,
} from './dto/action';
// A value export: `ActionKind` is a real enum, so neither side names an action with a literal.
export { ActionKind } from './dto/action';
