import React from 'react';
import TemplateRepositoryScreen from '../../components/TemplateRepositoryScreen';

type TemplateListPageProps = React.ComponentProps<typeof TemplateRepositoryScreen>;

export default function TemplateListPage(props: TemplateListPageProps) {
  return <TemplateRepositoryScreen {...props} />;
}
