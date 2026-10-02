import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user?: {
      id?: string;
      /** スタッフでログイン中なら Staff.id、代表者なら null */
      staffId?: string | null;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
  // スタッフのログイン（Credentials）の authorize が返す値
  interface User {
    ownerId?: string;
    sessionVersion?: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    staffId?: string;
    staffSessionVersion?: number;
    /** 削除・パスワード再設定されたスタッフのトークン */
    revoked?: boolean;
  }
}
