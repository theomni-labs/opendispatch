{{- define "opendispatch.fullname" -}}
{{ .Release.Name }}-opendispatch
{{- end }}

{{- define "opendispatch.labels" -}}
app.kubernetes.io/part-of: opendispatch
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "opendispatch.selector" -}}
app.kubernetes.io/part-of: opendispatch
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/* image: registry prefix, then digest over tag */}}
{{- define "opendispatch.image" -}}
{{- $img := .img -}}
{{- $repo := $img.repository -}}
{{- if .root.Values.global.imageRegistry }}{{ $repo = printf "%s/%s" (trimSuffix "/" .root.Values.global.imageRegistry) $repo }}{{ end -}}
{{- if $img.digest -}}
{{ $repo }}@{{ $img.digest }}
{{- else -}}
{{ $repo }}:{{ required (printf "images.%s.tag or digest is required" .name) $img.tag }}
{{- end -}}
{{- end }}

{{- define "opendispatch.podSecurity" -}}
automountServiceAccountToken: false
enableServiceLinks: false
securityContext:
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{- define "opendispatch.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end }}

{{- define "opendispatch.generatedSecret" -}}
{{ include "opendispatch.fullname" . }}-generated
{{- end }}

{{- define "opendispatch.publicHost" -}}
{{- (urlParse (required "global.publicUrl is required" .Values.global.publicUrl)).host -}}
{{- end }}

{{- define "opendispatch.publicHostname" -}}
{{- $h := include "opendispatch.publicHost" . -}}
{{- (split ":" $h)._0 -}}
{{- end }}

{{- define "opendispatch.issuer" -}}
{{- if .Values.keycloak.enabled -}}
{{ trimSuffix "/" .Values.global.publicUrl }}{{ .Values.keycloak.relativePath }}/realms/{{ .Values.keycloak.realm }}
{{- else -}}
{{ required "auth.issuer is required when keycloak.enabled is false" .Values.auth.issuer }}
{{- end -}}
{{- end }}

{{- define "opendispatch.engineUrl" -}}
http://{{ include "opendispatch.fullname" .root }}-engine-{{ .name }}:8080
{{- end }}

{{- define "opendispatch.engineEnv" -}}
- name: OPENDISPATCH_ENGINE_MODE
  value: engine
{{- range $name, $_ := .Values.engines }}
- name: OPENDISPATCH_ENGINE_{{ upper $name }}_URL
  value: {{ include "opendispatch.engineUrl" (dict "root" $ "name" $name) | quote }}
{{- end }}
{{- end }}

{{- define "opendispatch.tmpVolume" -}}
- name: tmp
  emptyDir:
    sizeLimit: 512Mi
{{- end }}

{{- define "opendispatch.peer" -}}
- podSelector:
    matchLabels:
      app.kubernetes.io/instance: {{ .rel }}
      {{ .key }}: {{ .value }}
{{- end }}

{{/* data_source of app-made records */}}
{{- define "opendispatch.recordSourceEnv" -}}
- name: OPENDISPATCH_RECORD_DATA_SOURCE
  value: {{ .Values.global.recordDataSource | quote }}
{{- end }}

{{- /* theme file path to a ConfigMap key */}}
{{- define "opendispatch.themeKey" -}}
{{ trimPrefix "files/keycloak-theme/" . | replace "/" "__" }}
{{- end }}
