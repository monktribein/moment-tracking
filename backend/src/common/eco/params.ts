import { Matches } from "class-validator";
import { Transform } from "class-transformer";
import { IsEntityId } from "../decorators/is-entity-id.decorator";

/** `:id` route parameter. */
export class IdParam {
  @IsEntityId() id!: string;
}

export const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const IsDay = () => Matches(DAY, { message: ({ property }) => `${property} must be a date as YYYY-MM-DD` });
export const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
export const Trim = () => Transform(trim);
