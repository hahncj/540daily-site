import { RouterContextProvider, createContext } from "react-router";
import type { Services } from "../server/app";

export const servicesContext = createContext<Services>();

export function createRouterContext(services: Services) {
  const context = new RouterContextProvider();
  context.set(servicesContext, services);
  return context;
}
