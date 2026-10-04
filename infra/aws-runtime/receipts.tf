data "archive_file" "worker" {
  type        = "zip"
  source_file = "${path.module}/worker.py"
  output_path = "${path.root}/.build/receipts.zip"
}
resource "aws_iam_role" "receipts" {
  name = "${var.name}-receipts"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}
resource "aws_iam_role_policy_attachment" "receipts_logs" {
  role       = aws_iam_role.receipts.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
resource "aws_iam_role_policy" "receipt_secret" {
  role = aws_iam_role.receipts.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect   = "Allow", Action = "ssm:GetParameter",
    Resource = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.team.account_id}:parameter${var.ssm_prefix}/KEA_DELIVERY_RECEIPT_SECRET"
  }] })
}
resource "aws_sqs_queue" "receipt_failures" {
  name                      = "${var.name}-receipt-failures"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}
resource "aws_iam_role_policy" "receipt_failures" {
  role = aws_iam_role.receipts.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = "sqs:SendMessage", Resource = aws_sqs_queue.receipt_failures.arn
  }] })
}
resource "aws_lambda_function" "receipts" {
  function_name    = "${var.name}-receipts"
  role             = aws_iam_role.receipts.arn
  filename         = data.archive_file.worker.output_path
  source_code_hash = data.archive_file.worker.output_base64sha256
  handler          = "worker.handler"
  runtime          = "python3.12"
  timeout          = 8
  dead_letter_config { target_arn = aws_sqs_queue.receipt_failures.arn }
  environment {
    variables = {
      KEA_API_URL                  = var.api_url,
      KEA_RECEIPT_SECRET_PARAMETER = "${var.ssm_prefix}/KEA_DELIVERY_RECEIPT_SECRET"
    }
  }
  depends_on = [aws_iam_role_policy.receipt_failures]
}
resource "aws_sns_topic" "ses_receipts" { name = "${var.name}-ses-receipts" }
resource "aws_sns_topic_policy" "ses_receipts" {
  arn = aws_sns_topic.ses_receipts.arn
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect   = "Allow", Principal = { Service = "ses.amazonaws.com" }, Action = "sns:Publish",
    Resource = aws_sns_topic.ses_receipts.arn,
    Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.team.account_id },
    ArnEquals = { "aws:SourceArn" = "arn:aws:ses:${var.region}:${data.aws_caller_identity.team.account_id}:configuration-set/${aws_sesv2_configuration_set.alerts.configuration_set_name}" } }
  }] })
}
resource "aws_sesv2_configuration_set_event_destination" "receipts" {
  configuration_set_name = aws_sesv2_configuration_set.alerts.configuration_set_name
  event_destination_name = "deliveries"
  event_destination {
    enabled              = true
    matching_event_types = ["DELIVERY", "BOUNCE", "COMPLAINT"]
    sns_destination { topic_arn = aws_sns_topic.ses_receipts.arn }
  }
  depends_on = [aws_sns_topic_policy.ses_receipts]
}
resource "aws_lambda_permission" "ses" {
  statement_id  = "FromSesReceiptTopic"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.receipts.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.ses_receipts.arn
}
resource "aws_sns_topic_subscription" "ses" {
  topic_arn  = aws_sns_topic.ses_receipts.arn
  protocol   = "lambda"
  endpoint   = aws_lambda_function.receipts.arn
  depends_on = [aws_lambda_permission.ses]
}
resource "aws_lambda_permission" "sms_logs" {
  statement_id  = "FromSmsDeliveryLogs"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.receipts.function_name
  principal     = "logs.${var.region}.amazonaws.com"
  source_arn    = "arn:aws:logs:${var.region}:${data.aws_caller_identity.team.account_id}:log-group:${var.sms_delivery_log_group}:*"
}
resource "aws_cloudwatch_log_subscription_filter" "sms_receipts" {
  name            = "kea-sms-receipts"
  log_group_name  = var.sms_delivery_log_group
  filter_pattern  = ""
  destination_arn = aws_lambda_function.receipts.arn
  depends_on      = [aws_lambda_permission.sms_logs]
}
resource "aws_connect_lambda_function_association" "opt_out" {
  instance_id  = element(split("/", var.connect_instance_arn), 1)
  function_arn = aws_lambda_function.receipts.arn
}
resource "aws_lambda_permission" "connect" {
  statement_id   = "FromConnect"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.receipts.function_name
  principal      = "connect.amazonaws.com"
  source_arn     = var.connect_instance_arn
  source_account = data.aws_caller_identity.team.account_id
}
resource "aws_connect_contact_flow" "bill_warning" {
  instance_id = element(split("/", var.connect_instance_arn), 1)
  name        = "${var.name}-bill-warning"
  description = "Consent gated private notice, human care and persistent opt out"
  type        = "CONTACT_FLOW"
  content = templatefile("${path.module}/connect-flow.json.tftpl", {
    worker_arn     = aws_lambda_function.receipts.arn,
    care_queue_arn = var.care_queue_arn
  })
  depends_on = [aws_connect_lambda_function_association.opt_out, aws_lambda_permission.connect]
}
output "connect_flow_id" { value = aws_connect_contact_flow.bill_warning.contact_flow_id }
output "receipt_failure_queue" { value = aws_sqs_queue.receipt_failures.url }
