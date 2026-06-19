"""
面试反馈 Agent
使用 Qwen 模型生成个性化的面试回答反馈
"""

import json
import logging
import re

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

# 面试反馈系统提示词
INTERVIEW_FEEDBACK_SYSTEM_PROMPT = """你是一位资深的技术面试官，请对候选人的回答进行专业评估。

请根据以下维度评估回答：
1. 内容相关性（是否回答了问题）
2. 结构清晰度（是否有条理、有逻辑）
3. 深度和细节（是否有具体例子、数据支撑）
4. 语言表达（是否流畅、专业）

请直接输出 JSON 格式，不要输出其他内容。JSON 格式如下：
{
    "score": <0-100 的数值>,
    "feedback": "<100-200字的具体反馈，指出优点和不足>",
    "suggestion": "<50-100字的改进建议>"
}

注意：
- score 要根据回答质量客观给出，不要总是给高分
- feedback 要具体，指出回答中的具体优点和不足
- suggestion 要可操作，给出具体的改进方向
- 如果回答很短（少于20字），score 不要超过60
- 如果回答离题或不相关，score 不要超过50
"""


class InterviewAgent:
    """
    面试反馈 Agent
    
    使用阿里云 Qwen 模型生成个性化的面试回答反馈
    """

    def __init__(self):
        if not settings.DASHSCOPE_API_KEY:
            raise RuntimeError("DashScope API Key 未配置")
        
        self.client = AsyncOpenAI(
            api_key=settings.DASHSCOPE_API_KEY,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
        self.model = "qwen-turbo"  # 使用快速模型

    async def generate_feedback(self, question: str, answer: str) -> dict:
        """
        生成面试回答反馈
        
        Args:
            question: 面试问题
            answer: 候选人回答（文本）
            
        Returns:
            dict: {"score": float, "feedback": str, "suggestion": str}
        """
        if not answer or not answer.strip():
            return {
                "score": 65.0,
                "feedback": "未检测到回答内容，请重新回答。",
                "suggestion": "请确保麦克风正常工作，并清晰地说出你的回答。",
            }

        user_prompt = f"""面试问题：{question}

候选人回答：{answer}

请给出评分和反馈。"""

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": INTERVIEW_FEEDBACK_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
            )

            content = response.choices[0].message.content.strip()
            
            # 尝试解析 JSON
            # 先尝试直接解析
            try:
                result = json.loads(content)
            except json.JSONDecodeError:
                # 如果失败，尝试提取 JSON 部分
                json_match = re.search(r"\{.*\}", content, re.DOTALL)
                if json_match:
                    result = json.loads(json_match.group())
                else:
                    raise ValueError("无法解析 AI 返回的 JSON")

            # 验证结果
            score = float(result.get("score", 70))
            score = max(0, min(100, score))  # 限制在 0-100
            feedback = str(result.get("feedback", "回答已收到"))
            suggestion = str(result.get("suggestion", "继续加油"))

            return {
                "score": round(score, 2),
                "feedback": feedback,
                "suggestion": suggestion,
            }

        except Exception as e:
            logger.error("AI 反馈生成失败: %s", e)
            # 降级到规则评分
            return self._rule_based_scoring(answer)

    def _rule_based_scoring(self, answer: str) -> dict:
        """
        降级方案：基于规则的评分
        """
        length = len(answer)
        score = 70.0

        if length < 20:
            score = 50.0
        elif length < 60:
            score = 65.0
        elif length < 150:
            score = 78.0
        else:
            score = 86.0

        structure_markers = ["首先", "其次", "最后", "例如", "因此", "结果", "第一", "第二"]
        score += min(sum(marker in answer for marker in structure_markers) * 2, 8)

        score = round(max(0.0, min(score, 100.0)), 2)

        if score >= 85:
            feedback = "回答内容充分，结构清晰，并体现了较好的岗位理解。"
            suggestion = "继续补充可量化结果，让优势更有说服力。"
        elif score >= 70:
            feedback = "回答覆盖了主要信息，具备一定条理性。"
            suggestion = "建议增加具体案例或更清晰的结构划分。"
        elif score >= 60:
            feedback = "回答基本切题，但内容和结构有待加强。"
            suggestion = "建议先列出回答要点，再组织语言。"
        else:
            feedback = "回答内容较少或离题，需要更多练习。"
            suggestion = "建议多进行模拟面试，提高表达能力和自信心。"

        return {
            "score": score,
            "feedback": feedback,
            "suggestion": suggestion,
        }
