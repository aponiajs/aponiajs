import type { ReactNode } from "react";

interface User {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

interface Props {
  readonly users: readonly User[];
}

export default function UsersIndex({ users }: Props): ReactNode {
  return (
    <main>
      <h1>Users</h1>
      <ul>
        {users.map((user) => (
          <li key={user.id}>
            {user.name} ({user.role})
          </li>
        ))}
      </ul>
    </main>
  );
}
