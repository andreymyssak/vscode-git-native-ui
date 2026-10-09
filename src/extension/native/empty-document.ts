import type { TextDocumentContentProvider, Uri } from 'vscode';

export class EmptyDocumentProvider implements TextDocumentContentProvider {
  provideTextDocumentContent(_uri: Uri): string {
    void _uri;

    return '';
  }
}
