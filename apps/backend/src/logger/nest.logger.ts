import { Injectable, LoggerService } from "@nestjs/common";
import { createGlobalLogger } from "@/logger/winston";

@Injectable()
export class NestLogger implements LoggerService {
  private _winston;
  private _context;

  constructor() {
    this._winston = createGlobalLogger();
    this._context = { context: "Nest" };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  error(message: string, _trace: string) {
    // _trace parameter is required by LoggerService interface but not used in this implementation
    this._winston.error(message, this._context);
  }

  log(message: string) {
    this._winston.info(message, this._context);
  }

  warn(message: string) {
    this._winston.warn(message, this._context);
  }

  info(message: string) {
    this._winston.info(message, this._context);
  }

  debug(message: string) {
    this._winston.debug(message, this._context);
  }

  verbose(message: string) {
    this._winston.verbose(message, this._context);
  }
}
