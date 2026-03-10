import { createSignal, Show } from 'solid-js';
import { Tutorial as TutorialCore } from '../../core/tutorial/Tutorial';

export function TutorialOverlay() {
  const tutorial = new TutorialCore();
  const [stepIndex, setStepIndex] = createSignal(tutorial.getStepIndex());
  const [active, setActive] = createSignal(tutorial.isActive());

  const step = () => tutorial.getCurrentStep();
  const isLast = () => tutorial.getStepIndex() === tutorial.getTotalSteps() - 1;

  const next = () => {
    tutorial.next();
    setStepIndex(tutorial.getStepIndex());
    setActive(tutorial.isActive());
  };

  const prev = () => {
    tutorial.prev();
    setStepIndex(tutorial.getStepIndex());
  };

  const dismiss = () => {
    tutorial.dismiss();
    setActive(false);
  };

  return (
    <Show when={active() && step()}>
      {(s) => (
        <div id="tutorial-overlay" class="visible" role="dialog" aria-label="Tutorial">
          <div class="tut-title">{s().title}</div>
          <div class="tut-desc">{s().description}</div>
          <div class="tut-footer">
            <span class="tut-step">Step {stepIndex() + 1} of {tutorial.getTotalSteps()}</span>
            <div class="tut-btns">
              <button class="tut-dismiss" onClick={dismiss}>Skip</button>
              <button onClick={prev}>Back</button>
              <button onClick={next}>{isLast() ? 'Finish' : 'Next'}</button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
