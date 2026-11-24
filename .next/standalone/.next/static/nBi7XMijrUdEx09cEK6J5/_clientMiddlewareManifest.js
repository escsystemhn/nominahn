self.__MIDDLEWARE_MATCHERS = [
  {
    "regexp": "^(?:\\/(_next\\/data\\/[^/]{1,}))?(?:\\/((?!_next\\/static|_next\\/image|favicon\\.ico|[^/]+\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|woff|woff2|ttf|webmanifest)$).*))(\\.json|\\.rsc|\\.segments\\/.+\\.segment\\.rsc)?[\\/#\\?]?$",
    "originalSource": "/((?!_next/static|_next/image|favicon\\.ico|[^/]+\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|woff|woff2|ttf|webmanifest)$).*)"
  }
];self.__MIDDLEWARE_MATCHERS_CB && self.__MIDDLEWARE_MATCHERS_CB()