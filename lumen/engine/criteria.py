"""Quality criteria catalogue: ISO/IEC/IEEE 29148:2018 §5.2.5/§5.2.6, IEEE Std 830-1998 §4.3 + LÜMEN practice."""
from __future__ import annotations

# key: (Russian name, standard reference, short definition, basis)
REQUIREMENT_CRITERIA: dict[str, tuple[str, str, str, str]] = {
    "unambiguous": ("Однозначность", "ISO 29148 §5.2.5 Unambiguous; IEEE 830 §4.3.2",
                    "Требование допускает только одно толкование.", "normative"),
    "complete": ("Полнота", "ISO 29148 §5.2.5 Complete; IEEE 830 §4.3.3",
                 "Требование не нуждается в дополнении для понимания и реализации.", "normative"),
    "verifiable": ("Проверяемость", "ISO 29148 §5.2.5 Verifiable; IEEE 830 §4.3.6",
                   "Выполнение можно доказать конечным объективным способом (тест, анализ, осмотр).", "normative"),
    "consistent": ("Непротиворечивость", "ISO 29148 §5.2.6 Consistent; IEEE 830 §4.3.4",
                   "Не конфликтует с другими требованиями документа.", "normative"),
    "necessary": ("Необходимость", "ISO 29148 §5.2.5 Necessary",
                  "Удаление требования создаёт пробел в возможностях системы.", "normative"),
    "singular": ("Атомарность", "ISO 29148 §5.2.5 Singular",
                 "Требование описывает одну возможность/характеристику.", "normative"),
    "feasible": ("Реализуемость", "ISO 29148 §5.2.5 Feasible",
                 "Реализуемо в рамках ограничений системы.", "normative"),
    "traceable": ("Прослеживаемость", "IEEE 830 §4.3.8; ISO 29148 §5.2.8",
                  "Однозначно идентифицировано и связано с источником/целью.", "normative"),
    "correct": ("Корректность", "ISO 29148 §5.2.5 Correct; IEEE 830 §4.3.1",
                "Точно отражает потребность и не содержит фактических ошибок.", "normative"),
    "implementation_free": ("Без лишних проектных решений", "ISO 29148 §5.2.5 Appropriate (implementation-free)",
                            "Описывает «что», а не «как», если способ не является обоснованным ограничением.",
                            "normative"),
    "inputs_defined": ("Определённость входных данных", "LÜMEN practice",
                       "Описаны входы: формат, диапазоны, обязательность.", "expert"),
    "outputs_defined": ("Определённость выходных данных", "LÜMEN practice",
                        "Описан результат: формат, значения, получатель.", "expert"),
    "errors_defined": ("Ошибки и исключения", "LÜMEN practice",
                       "Описано поведение при ошибках, отказах и исключениях.", "expert"),
    "acceptance": ("Критерии приёмки", "LÜMEN practice",
                   "Есть критерий приёмки или однозначный тестовый оракул.", "expert"),
    "boundaries": ("Граничные условия", "LÜMEN practice",
                   "Определены границы диапазонов и поведение на них.", "expert"),
}

SET_CRITERIA: dict[str, tuple[str, str, str, str]] = {
    "set_complete": ("Полнота набора", "ISO 29148 §5.2.6 Complete; IEEE 830 §4.3.3",
                     "Набор покрывает все необходимые возможности, сценарии и ответы на все входы.", "normative"),
    "set_consistent": ("Согласованность набора", "ISO 29148 §5.2.6 Consistent; IEEE 830 §4.3.4",
                       "Нет конфликтов, дублей и рассогласования терминов/единиц.", "normative"),
    "set_feasible": ("Реализуемость набора", "ISO 29148 §5.2.6 Feasible",
                     "Набор реализуем в рамках ограничений проекта.", "normative"),
    "set_comprehensible": ("Понятность набора", "ISO 29148 §5.2.6 Comprehensible",
                           "Понятно, что ожидается от системы и как требования связаны.", "normative"),
    "set_validatable": ("Возможность валидации", "ISO 29148 §5.2.6 Able to be validated",
                        "Можно доказать, что набор удовлетворяет потребность.", "normative"),
    "ranked": ("Ранжирование по важности/стабильности", "IEEE 830 §4.3.5",
               "Требования имеют приоритет и/или признак стабильности.", "normative"),
    "modifiable": ("Модифицируемость", "IEEE 830 §4.3.7",
                   "Структура, версия и отсутствие избыточности позволяют безопасно изменять документ.", "normative"),
    "set_traceable": ("Прослеживаемость набора", "IEEE 830 §4.3.8",
                      "Идентификаторы, источники и связи требований зафиксированы.", "normative"),
    "terminology": ("Согласованность терминологии", "ISO 29148 §5.2.6 Consistent",
                    "Одни и те же сущности названы одинаково.", "normative"),
    "integration_contract": ("Полнота интеграционных контрактов", "LÜMEN practice",
                             "Интерфейсы описаны с методами, форматами, ошибками и семантикой статусов.",
                             "expert"),
}

ALL_CRITERIA = {**REQUIREMENT_CRITERIA, **SET_CRITERIA, "fintech": ("FinTech-риск", "LÜMEN Risk Engine",
                                                                       "Отраслевой риск финансовой системы.",
                                                                       "expert")}


def criterion_name(key: str) -> str:
    return ALL_CRITERIA.get(key, (key,))[0]


def criterion_ref(key: str) -> str:
    v = ALL_CRITERIA.get(key)
    return v[1] if v else ""


def criterion_basis(key: str) -> str:
    v = ALL_CRITERIA.get(key)
    return v[3] if v else "expert"
