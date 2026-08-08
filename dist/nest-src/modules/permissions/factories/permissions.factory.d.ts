import { Permissions } from './permissions';
export declare const PermissionsFactory: {
    provide: symbol;
    useFactory: (permissions: Permissions) => Permissions;
    inject: (typeof Permissions)[];
};
