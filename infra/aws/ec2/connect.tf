# Optional Amazon Connect voice alerts. Off by default: nothing is created or billed
# until the alert gateways exist and the owner deploys with ENABLE_VOICE_ALERTS=1.
# The instance, its NZ number and its flow live and die with the session.
variable "enable_voice_alerts" {
  type    = bool
  default = false
}

resource "aws_connect_instance" "alerts" {
  count                    = var.enable_voice_alerts ? 1 : 0
  instance_alias           = local.name
  identity_management_type = "CONNECT_MANAGED"
  inbound_calls_enabled    = true
  outbound_calls_enabled   = true
}

# Claimed per session; the caller number changes between sessions.
resource "aws_connect_phone_number" "alerts" {
  count        = var.enable_voice_alerts ? 1 : 0
  target_arn   = aws_connect_instance.alerts[0].arn
  country_code = "NZ"
  type         = "DID"
}

# Plays the private notice prepared by ConnectGateway, then hangs up.
resource "aws_connect_contact_flow" "alerts" {
  count       = var.enable_voice_alerts ? 1 : 0
  instance_id = aws_connect_instance.alerts[0].id
  name        = "Kea alert call"
  type        = "CONTACT_FLOW"
  content = jsonencode({
    Version     = "2019-10-30"
    StartAction = "play"
    Metadata    = {}
    Actions = [
      {
        Identifier = "play"
        Type       = "MessageParticipant"
        Parameters = { Media = { Uri = "$.Attributes.kea_notice_audio", SourceType = "S3", MediaType = "Audio" } }
        Transitions = {
          NextAction = "end"
          Errors     = [{ NextAction = "end", ErrorType = "NoMatchingError" }]
        }
      },
      {
        Identifier  = "end"
        Type        = "DisconnectParticipant"
        Parameters  = {}
        Transitions = {}
      },
    ]
  })
}

output "connect_instance_id" { value = one(aws_connect_instance.alerts[*].id) }
output "connect_contact_flow_id" { value = one(aws_connect_contact_flow.alerts[*].contact_flow_id) }
output "connect_phone_number" { value = one(aws_connect_phone_number.alerts[*].phone_number) }
