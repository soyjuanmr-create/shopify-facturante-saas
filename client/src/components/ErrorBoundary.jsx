import React from 'react';
import { Page, Card, Text, BlockStack, Button } from '@shopify/polaris';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Page title="Error inesperado">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" tone="critical">Algo salió mal</Text>
              <Text tone="subdued">{this.state.message}</Text>
              <Button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}>
                Recargar
              </Button>
            </BlockStack>
          </Card>
        </Page>
      );
    }
    return this.props.children;
  }
}
