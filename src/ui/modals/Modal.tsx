import { Show, type JSX } from 'solid-js';

interface ModalProps {
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  style?: JSX.CSSProperties;
  children: JSX.Element;
}

export function Modal(props: ModalProps) {
  const onOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  return (
    <Show when={props.open}>
      <div class="modal-overlay visible" id={props.id} role="dialog" aria-label={props.title} onClick={onOverlayClick}>
        <div class="modal-panel" style={props.style}>
          <div class="modal-header">
            <div class="modal-title">{props.title}</div>
            <button class="modal-close" onClick={props.onClose}>&times;</button>
          </div>
          <div class="modal-body">
            {props.children}
          </div>
        </div>
      </div>
    </Show>
  );
}
