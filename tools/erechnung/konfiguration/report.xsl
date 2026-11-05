<?xml version="1.0" encoding="UTF-8"?>
<!--
  Prüfbericht für den KoSIT-Validator: fasst Schema- und Schematron-
  Ergebnisse zusammen. valid="true" nur, wenn es keinen Schema-Fehler
  und keine Regelverletzung der Stufe fatal/error gibt (Warnungen
  werden gelistet, machen die Datei aber nicht ungültig).
-->
<xsl:stylesheet version="2.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:in="http://www.xoev.de/de/validator/framework/1/createreportinput"
    xmlns:s="http://www.xoev.de/de/validator/framework/1/scenarios"
    xmlns:svrl="http://purl.oclc.org/dsdl/svrl"
    xmlns:rep="urn:maja-logistik:erechnung:pruefbericht"
    exclude-result-prefixes="in s svrl">

  <xsl:output method="xml" indent="yes"/>

  <xsl:function name="rep:stufe" as="xs:string" xmlns:xs="http://www.w3.org/2001/XMLSchema">
    <xsl:param name="flag" as="xs:string?"/>
    <xsl:sequence select="if ($flag = 'warning') then 'warning' else if ($flag = 'information') then 'information' else 'error'"/>
  </xsl:function>

  <xsl:template match="/">
    <xsl:variable name="eingabe" select="in:createReportInput"/>
    <xsl:variable name="syntax" select="$eingabe/in:validationResultsWellformedness/in:xmlSyntaxError
                                       | $eingabe/in:validationResultsXmlSchema/in:xmlSyntaxError"/>
    <xsl:variable name="regeln" select="$eingabe/in:validationResultsSchematron//(svrl:failed-assert | svrl:successful-report)"/>
    <xsl:variable name="fehler" select="$syntax[in:severityCode != 'SEVERITY_WARNING']
                                       | $regeln[rep:stufe(@flag) = 'error']"/>
    <rep:report valid="{if ($eingabe/s:scenario and empty($fehler) and empty($eingabe/in:processingError)) then 'true' else 'false'}">
      <rep:scenario><xsl:value-of select="($eingabe/s:scenario/s:name, '(kein passendes Szenario)')[1]"/></rep:scenario>
      <xsl:for-each select="$eingabe/in:processingError/in:error">
        <rep:message level="error" id="VERARBEITUNG"><xsl:value-of select="normalize-space(.)"/></rep:message>
      </xsl:for-each>
      <xsl:for-each select="$syntax">
        <rep:message level="{if (in:severityCode = 'SEVERITY_WARNING') then 'warning' else 'error'}" id="XSD"
                     location="{concat('Zeile ', in:rowNumber, ', Spalte ', in:columnNumber)}">
          <xsl:value-of select="normalize-space(in:message)"/>
        </rep:message>
      </xsl:for-each>
      <xsl:for-each select="$regeln">
        <rep:message level="{rep:stufe(@flag)}" id="{@id}" location="{@location}">
          <xsl:value-of select="normalize-space(svrl:text)"/>
        </rep:message>
      </xsl:for-each>
    </rep:report>
  </xsl:template>
</xsl:stylesheet>
