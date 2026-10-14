import {
  BadGatewayException,
  HttpException,
  InternalServerErrorException,
  ServiceUnavailableException
} from "@nestjs/common";
import OpenAI from "openai";
import { ModelOutputError } from "./model-json";

/**
 * Turns a service failure into a response the dialog can show.
 *
 * Nest's default filter answers a plain Error with "Internal server error", which tells the user
 * nothing. The two cases worth a sentence: the OpenAI key is missing (a 503, and the UI says the
 * assistant is not configured), and the model answered with something unusable (a 502, retry).
 */
export function toHttpException(err: unknown): HttpException {
  if (err instanceof HttpException) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/not configured/i.test(message)) {
    return new ServiceUnavailableException(
      "The assistant is not configured on this server (OpenAI key missing)"
    );
  }
  if (err instanceof ModelOutputError) {
    return new BadGatewayException(message);
  }
  // Timeouts, rate limits and rejected requests from the model API, with their status so the log
  // and the toast say which. The prompt is never part of the message.
  if (err instanceof OpenAI.APIError) {
    return new BadGatewayException(
      `The AI service did not answer (${err.status ?? "connection"}): ${err.message}`
    );
  }
  return new InternalServerErrorException(message);
}
