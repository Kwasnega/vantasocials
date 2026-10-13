export type AdminServiceVisibilityRow = {
  platform_id: string;
  active: boolean;
};

export type AdminPlatformVisibilityRow = {
  id: string;
  active: boolean;
};

export function deriveAdminServiceVisibility<
  P extends AdminPlatformVisibilityRow,
  S extends AdminServiceVisibilityRow,
>(platforms: P[], services: S[]) {
  const customerPlatforms = platforms.filter((platform) => platform.active);
  const customerPlatformIds = new Set(customerPlatforms.map((platform) => platform.id));
  const publishedByPlatform = new Map(
    customerPlatforms.map((platform) => [
      platform.id,
      services.filter((service) => service.active && service.platform_id === platform.id),
    ]),
  );

  return {
    customerPlatforms,
    publishedByPlatform,
    hiddenServices: services.filter(
      (service) => !service.active && customerPlatformIds.has(service.platform_id),
    ),
    unavailablePlatformServices: services.filter(
      (service) => !customerPlatformIds.has(service.platform_id),
    ),
  };
}
