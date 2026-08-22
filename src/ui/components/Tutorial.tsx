import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Tutorial as TutorialCore } from '../../core/tutorial/Tutorial';
import { registerTutorialProbe } from '../../agent/registry';

export function TutorialOverlay() {
  const tutorial = new TutorialCore();
  const [stepIndex, setStepIndex] = createSignal(tutorial.getStepIndex());
  const [active, setActive] = createSignal(tutorial.isActive());

  // 讓 `agent.status()` 看得到教程走到哪。這一份狀態只有這個元件有 ——
  // 每次開局都 `new` 一個新的，不是全域單例。
  onMount(() => {
    registerTutorialProbe(() => ({
      active: active(),
      step: stepIndex() + 1,   // 對外從 1 算起，跟畫面上的「Step 3 of 9」一致
      total: tutorial.getTotalSteps(),
    }));
  });
  onCleanup(() => registerTutorialProbe(null));

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
