import React from 'react';
import TaskBuilderScreen from '../../components/TaskBuilderScreen';

type TaskListPageProps = React.ComponentProps<typeof TaskBuilderScreen>;

export default function TaskListPage(props: TaskListPageProps) {
  return <TaskBuilderScreen {...props} />;
}
