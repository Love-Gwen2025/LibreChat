import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';

const mockNewConversation = jest.fn();
let mockConversation: Record<string, unknown> | null;
let mockAgentsMap: Record<string, Record<string, unknown>> | undefined;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/Providers', () => ({
  useAgentsMapContext: () => mockAgentsMap,
  useChatContext: () => ({
    conversation: mockConversation,
    isSubmitting: false,
    newConversation: mockNewConversation,
  }),
}));

jest.mock('@librechat/client', () => ({
  SelectDropDown: ({
    title,
    value,
    setValue,
    availableValues,
    disabled,
  }: {
    title: string;
    value: string;
    setValue: (value: string) => void;
    availableValues: string[];
    disabled: boolean;
  }) => (
    <select
      aria-label={title}
      value={value}
      disabled={disabled}
      onChange={(event) => setValue(event.target.value)}
    >
      {availableValues.map((model) => (
        <option key={model} value={model}>
          {model}
        </option>
      ))}
    </select>
  ),
}));

import AgentModelSwitcher from '../AgentModelSwitcher';

describe('AgentModelSwitcher', () => {
  beforeEach(() => {
    mockNewConversation.mockReset();
    mockConversation = {
      conversationId: 'new',
      endpoint: 'agents',
      agent_id: 'agent_image',
      agent_model: 'gpt-5.5',
      spec: 'image-generation',
    };
    mockAgentsMap = {
      agent_image: {
        id: 'agent_image',
        allowed_models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
      },
    };
  });

  it('starts a new conversation with the selected allowlisted model', () => {
    render(<AgentModelSwitcher />);

    fireEvent.change(screen.getByLabelText('com_ui_model'), {
      target: { value: 'gpt-5.4' },
    });

    expect(mockNewConversation).toHaveBeenCalledWith({
      template: expect.objectContaining({
        endpoint: 'agents',
        agent_id: 'agent_image',
        agent_model: 'gpt-5.4',
        spec: 'image-generation',
      }),
      preset: expect.objectContaining({ agent_model: 'gpt-5.4' }),
      buildDefault: false,
    });
    const [{ template, preset }] = mockNewConversation.mock.calls[0];
    expect(template).not.toHaveProperty('conversationId');
    expect(preset).not.toHaveProperty('conversationId');
  });

  it('stays hidden when the agent has no model choices', () => {
    mockAgentsMap = {
      agent_image: {
        id: 'agent_image',
        allowed_models: ['gpt-5.5'],
      },
    };

    render(<AgentModelSwitcher />);

    expect(screen.queryByTestId('agent-model-switcher')).not.toBeInTheDocument();
  });
});
