import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, map } from "rxjs";

export class PickOptions {
  type?: any;

  typeFactory?: ((data: any) => any) | Array<(data: any) => any>;

  isOptional?: boolean;
}

export function pick<T>(oType: T | undefined, data: any): T | undefined {
  const type = oType as any;

  if (!type) {
    // No type, returns directly
    return;
  }

  if (Array.isArray(data)) {
    // If the data is an array, we need to pick each item
    if (!Array.isArray(type)) {
      // Invalid type
      return;
    }
    if (!type[0]?.prototype?.pick) {
      // The type can not be picked
      return data as T;
    }
    return data.map((v) => type[0].prototype.pick(v)) as T;
  }

  if (!type?.prototype?.pick) {
    // The type can not be picked
    return data as T;
  }
  return type.prototype.pick(data);
}

export function pickWithFactory<T>(
  factory: ((data: any) => T) | Array<(data: any) => any>,
  data: any,
): T | undefined {
  if (Array.isArray(factory)) {
    if (Array.isArray(data)) {
      return data.map((v) => pick(factory[0](v), v)) as T;
    }
  } else {
    return pick(factory(data), data);
  }
}

export function Pick(options?: PickOptions) {
  const type = options?.type;
  const typeFactory = options?.typeFactory;
  const isOptional = options?.isOptional;

  return function (target: any, key: string) {
    const oPick = target.pick;
    target.pick = function (v: any) {
      // Even the data is invalid, we still need to pick the properties
      const data = typeof v === "object" ? v : {};
      const res = oPick ? oPick(data) : {};
      if (typeof res !== "object") {
        // The type explicitly disabled pick
        return;
      }
      if (typeFactory && !(isOptional && data == null)) {
        // If the typeFactory is specified, pick the data recursively
        res[key] = pickWithFactory(typeFactory, data[key]);
      } else if (type && !(isOptional && data == null)) {
        // If the type is specified, pick the data recursively
        res[key] = pick(type, data[key]);
      } else if (data[key] === undefined) {
        // Preserve undefined properties
        res[key] = null;
      } else {
        // Preserve properties without type
        res[key] = data[key];
      }
      return res;
    };
  };
}

@Injectable()
export class PickInterceptor implements NestInterceptor {
  constructor(private readonly options?: PickOptions) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data: any) => {
        if (data == null && this.options?.isOptional) {
          return null;
        }
        if (this.options?.typeFactory) {
          return pickWithFactory(this.options.typeFactory, data);
        } else {
          return pick(this.options?.type, data);
        }
      }),
    );
  }
}
