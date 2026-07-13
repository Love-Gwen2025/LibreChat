import { memo, useCallback, useMemo } from 'react';
import { SelectDropDown } from '@librechat/client';
import { Constants, EModelEndpoint, isAgentsEndpoint } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { useAgentsMapContext, useChatContext } from '~/Providers';

function AgentModelSwitcher() {
  const localize = useLocalize();
  const agentsMap = useAgentsMapContext();
  const { conversation, isSubmitting, newConversation } = useChatContext();
  const agent = conversation?.agent_id ? agentsMap?.[conversation.agent_id] : undefined;
  const allowedModels = useMemo(
    () =>
      Array.from(
        new Set(
          (agent?.allowed_models ?? []).filter(
            (model): model is string => typeof model === 'string' && model.length > 0,
          ),
        ),
      ),
    [agent?.allowed_models],
  );

  const selectedModel =
    conversation?.agent_model && allowedModels.includes(conversation.agent_model)
      ? conversation.agent_model
      : allowedModels[0];

  const setModel = useCallback(
    (model: string) => {
      if (
        !conversation?.agent_id ||
        !allowedModels.includes(model) ||
        model === selectedModel ||
        isSubmitting
      ) {
        return;
      }

      const template = {
        conversationId: Constants.NEW_CONVO as string,
        endpoint: EModelEndpoint.agents,
        agent_id: conversation.agent_id,
        agent_model: model,
        spec: conversation.spec,
        iconURL: conversation.iconURL,
        greeting: conversation.greeting,
        chatProjectId: conversation.chatProjectId,
      };

      newConversation({
        template,
        preset: template,
        buildDefault: false,
      });
    },
    [allowedModels, conversation, isSubmitting, newConversation, selectedModel],
  );

  if (
    !conversation ||
    !isAgentsEndpoint(conversation.endpoint) ||
    !conversation.agent_id ||
    allowedModels.length < 2 ||
    !selectedModel
  ) {
    return null;
  }

  return (
    <div
      className="mx-auto flex w-full max-w-3xl justify-end px-2 pb-1 sm:px-4 xl:max-w-4xl"
      data-testid="agent-model-switcher"
    >
      <SelectDropDown
        title={localize('com_ui_model')}
        value={selectedModel}
        setValue={setModel}
        availableValues={allowedModels}
        disabled={isSubmitting}
        showAbove={true}
        showLabel={false}
        containerClassName="max-w-full"
        subContainerClassName="w-[190px] max-w-full"
        className="h-8 rounded-md border-border-light bg-presentation py-1 pl-2 pr-8"
        currentValueClass="max-w-[155px]"
      />
    </div>
  );
}

export default memo(AgentModelSwitcher);
