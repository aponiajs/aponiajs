import { defineComponent, h, type PropType } from "vue";

interface User {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

export default defineComponent({
  name: "UsersIndex",
  props: {
    users: {
      type: Array as PropType<readonly User[]>,
      required: true,
    },
  },
  setup(props) {
    return () =>
      h("main", [
        h("h1", "Users"),
        h(
          "ul",
          props.users.map((user) => h("li", { key: user.id }, `${user.name} (${user.role})`)),
        ),
      ]);
  },
});
