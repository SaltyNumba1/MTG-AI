import argparse
import json
from pathlib import Path

import torch
from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from trl import SFTTrainer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Minimal LoRA fine-tuning entry point for Commander data.")
    parser.add_argument("--model", required=True, help="Base Hugging Face model name or local path")
    parser.add_argument("--train-file", required=True, help="Processed chat-format training JSONL file")
    parser.add_argument("--eval-file", default="", help="Processed chat-format evaluation JSONL file")
    parser.add_argument("--output-dir", required=True, help="Directory to save the adapter and tokenizer")
    parser.add_argument("--epochs", type=float, default=1.0, help="Number of training epochs")
    parser.add_argument("--learning-rate", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=1, help="Per-device train batch size")
    parser.add_argument("--grad-accum", type=int, default=8, help="Gradient accumulation steps")
    parser.add_argument("--max-seq-length", type=int, default=2048, help="Maximum sequence length")
    parser.add_argument("--lora-r", type=int, default=16, help="LoRA rank")
    parser.add_argument("--lora-alpha", type=int, default=32, help="LoRA alpha")
    parser.add_argument("--lora-dropout", type=float, default=0.05, help="LoRA dropout")
    return parser.parse_args()


def _messages_to_text(messages: list[dict], tokenizer: AutoTokenizer) -> str:
    if hasattr(tokenizer, "apply_chat_template"):
        return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)

    chunks = []
    for message in messages:
        role = message.get("role", "user").upper()
        content = message.get("content", "")
        chunks.append(f"{role}: {content}")
    return "\n\n".join(chunks)


def _format_record(record: dict, tokenizer: AutoTokenizer) -> dict:
    messages = record.get("messages") or []
    if not messages:
        raise ValueError("Each training row must contain a non-empty 'messages' array.")
    return {"text": _messages_to_text(messages, tokenizer)}


def _validate_jsonl(path: Path) -> None:
    if not path.exists():
        raise ValueError(f"Dataset file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        for index, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            payload = json.loads(line)
            if "messages" not in payload:
                raise ValueError(f"{path} line {index} is missing 'messages'.")


def main() -> None:
    args = parse_args()
    train_file = Path(args.train_file)
    eval_file = Path(args.eval_file) if args.eval_file else None
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    _validate_jsonl(train_file)
    if eval_file:
        _validate_jsonl(eval_file)

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        device_map="auto" if torch.cuda.is_available() else None,
    )

    data_files = {"train": str(train_file)}
    if eval_file:
        data_files["eval"] = str(eval_file)

    dataset = load_dataset("json", data_files=data_files)
    formatted_train = dataset["train"].map(lambda row: _format_record(row, tokenizer))
    formatted_eval = dataset["eval"].map(lambda row: _format_record(row, tokenizer)) if "eval" in dataset else None

    peft_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )

    training_args = TrainingArguments(
        output_dir=str(output_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.learning_rate,
        logging_steps=10,
        save_strategy="epoch",
        eval_strategy="epoch" if formatted_eval is not None else "no",
        bf16=torch.cuda.is_available(),
        fp16=False,
        report_to="none",
        remove_unused_columns=False,
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=formatted_train,
        eval_dataset=formatted_eval,
        args=training_args,
        peft_config=peft_config,
        dataset_text_field="text",
        max_seq_length=args.max_seq_length,
    )

    trainer.train()
    trainer.model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    print(f"Saved LoRA adapter to {output_dir}")


if __name__ == "__main__":
    main()