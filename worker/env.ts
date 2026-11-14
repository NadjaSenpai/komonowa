export type Role = "admin" | "member";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  avatar_id: string | null;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    user: SessionUser;
  };
}
