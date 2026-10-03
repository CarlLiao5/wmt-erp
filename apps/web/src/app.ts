export const navigation = ['Dashboard', 'Items', 'Orders', 'Returns', 'Inventory', 'WFS', 'Pricing', 'Performance', 'Members', 'Stores', 'Sync Status'] as const;
export function App({ role = 'member' }: { role?: 'admin' | 'member' }) { return { role, navigation: role === 'admin' ? navigation : navigation.filter((item) => !['Members', 'Stores'].includes(item)) }; }
