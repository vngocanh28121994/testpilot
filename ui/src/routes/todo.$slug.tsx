import { createFileRoute } from '@tanstack/react-router';
import TodoPanel from '@/panels/Todo';

export const Route = createFileRoute('/todo/$slug')({
  component: function TodoRoute() {
    const { slug } = Route.useParams();
    return <TodoPanel slug={slug} />;
  },
});
